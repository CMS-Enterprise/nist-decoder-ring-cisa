/**
 * Secret-rotation -> ECS force-new-deployment Lambda.
 *
 * Invoked by an EventBridge rule on the Secrets Manager `RotationSucceeded`
 * event for the RDS-managed master-user secret. The running ECS task read the
 * DB password once at container boot (app/entrypoint.mjs) and cannot pick up a
 * rotated password without being replaced — AWS confirms there is no in-task
 * live refresh of a rotated secret. Forcing a new deployment starts a fresh
 * task that re-reads the current secret; the deployment is a zero-downtime
 * rolling replace (the service has a circuit breaker with rollback).
 *
 * Idempotent: calling UpdateService(forceNewDeployment) repeatedly just starts
 * one rolling deployment at a time, so a duplicate event is harmless.
 *
 * Runtime: nodejs22.x. @aws-sdk/client-ecs ships in the Lambda Node runtime,
 * so this function has no bundled dependencies.
 */
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";

const ecs = new ECSClient({});

export const handler = async (event) => {
  const cluster = process.env.CLUSTER_NAME;
  const service = process.env.SERVICE_NAME;

  console.log(
    `[rotation-redeploy] event received: ${JSON.stringify(event?.["detail-type"] ?? event?.detail?.eventName ?? "unknown")}`,
  );

  if (!cluster || !service) {
    throw new Error("CLUSTER_NAME and SERVICE_NAME environment variables are required");
  }

  let out;
  try {
    out = await ecs.send(
      new UpdateServiceCommand({
        cluster,
        service,
        forceNewDeployment: true,
      }),
    );
  } catch (err) {
    // The service is created only once the HTTPS listener is on, and the secret can rotate
    // before that. With no service, no task holds the old password and there is nothing to
    // redeploy; throwing would only make Lambda retry and fire the function's error alarm.
    if (err?.name === "ServiceNotFoundException") {
      console.log(
        `[rotation-redeploy] ${service} does not exist on ${cluster} yet; nothing to redeploy`,
      );
      return { ok: true, cluster, service, deploymentId: null };
    }
    throw err;
  }

  const deploymentId = out.service?.deployments?.[0]?.id ?? "unknown";
  console.log(
    `[rotation-redeploy] forced new deployment of ${service} on ${cluster} (deployment ${deploymentId})`,
  );

  return { ok: true, cluster, service, deploymentId };
};
