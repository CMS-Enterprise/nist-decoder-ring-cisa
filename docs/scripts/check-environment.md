# check-environment

`scripts/check-environment.sh` is documented in [`docs/architecture/docker-environments.md`](../architecture/docker-environments.md), which the script's header names: which local environment is running, and how to switch between them.

`scripts/test_shell_scripts.py` runs it with `ps` and `docker` stubbed and checks which environment it reports for each combination of a dev server, the debug container and the runner container. It runs in `make ci-test-python` and `make test-scripts`.
