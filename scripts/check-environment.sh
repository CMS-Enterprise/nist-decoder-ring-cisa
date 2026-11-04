#!/bin/bash
# Docs: docs/architecture/docker-environments.md
# Quick script to check which local environment (if any) is running.

echo "================================================"
echo "🔍 Checking Current Environment"
echo "================================================"
echo ""

# Local dev process (next dev on the host)
LOCAL_DEV=$(ps aux | grep "next dev" | grep -v grep | wc -l)

# Docker containers (compose). The runner container is zt-decoder-ring-app; the opt-in
# debug container is zt-decoder-ring-app-debug (exclude it from the runner match).
CONTAINER=$(docker compose ps --format json 2>/dev/null | grep "zt-decoder-ring-app" | grep -v "app-debug" | wc -l)
DEBUG=$(docker compose ps --format json 2>/dev/null | grep "zt-decoder-ring-app-debug" | wc -l)

if [ "$LOCAL_DEV" -gt 0 ]; then
    echo "✅ LOCAL DEVELOPMENT (no Docker)"
    echo "   ├─ Running directly on the host (next dev)"
    echo "   ├─ URL: http://localhost:3000"
    echo "   └─ Stop with: Ctrl+C in the terminal"
    echo ""
elif [ "$DEBUG" -gt 0 ]; then
    echo "🐚 DEBUG CONTAINER (dev-shell image — LOCAL ONLY, never deployed)"
    echo "   ├─ Hot-reload dev image with a shell"
    echo "   ├─ URL: http://localhost:13001"
    echo "   ├─ Shell: docker compose --profile debug exec app-debug sh"
    echo "   ├─ Logs: make container-logs"
    echo "   └─ Stop with: make container-down"
    echo ""
    docker compose --profile debug ps | grep -E "NAME|app-debug|db"
    echo ""
elif [ "$CONTAINER" -gt 0 ]; then
    echo "✅ CONTAINERIZED (hardened runner — exactly what ships)"
    echo "   ├─ The production image, run locally"
    echo "   ├─ URL: http://localhost:13000"
    echo "   ├─ Shell access: ❌ none (hardened, no shell)"
    echo "   ├─ Logs: make container-logs"
    echo "   └─ Stop with: make container-down"
    echo ""
    docker compose --profile container ps | grep -E "NAME|app|db"
    echo ""
else
    echo "❌ NO ENVIRONMENT RUNNING"
    echo ""
    echo "   Start one of:"
    echo "   ├─ make dev             (local development, no Docker)"
    echo "   ├─ make container-up    (the hardened image that ships, :13000)"
    echo "   └─ make container-debug (local-only dev-shell, :13001)"
    echo ""
fi

echo "================================================"
echo "💡 Quick Commands"
echo "================================================"
echo "Check containers: docker compose ps"
echo "Check processes:  ps aux | grep 'next dev'"
echo "Test local dev:   curl http://localhost:3000/api/health"
echo "Test container:   curl http://localhost:13000/api/health"
echo "Test debug:       curl http://localhost:13001/api/health"
echo "Read guide:       cat docs/architecture/docker-environments.md"
echo ""
