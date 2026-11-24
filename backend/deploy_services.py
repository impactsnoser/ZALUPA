"""Protected one-tap deployment trigger for the ZALUPA monorepo.

The caller can only trigger the two configured Railway services. It cannot
choose a project, service, environment, branch, or commit. Railway credentials
remain server-side; the Android shortcut only holds DEPLOY_TRIGGER_TOKEN.
"""

from __future__ import annotations

import asyncio
import hmac
import os

import httpx
from fastapi import APIRouter, Header, HTTPException

router = APIRouter(prefix="/api/deploy", tags=["deploy"])

GITHUB_COMMIT_URL = "https://api.github.com/repos/impactsnoser/ZALUPA/commits/main"
RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2"

DEPLOY_BOTH_MUTATION = """
mutation DeployBoth(
  $frontendServiceId: String!,
  $backendServiceId: String!,
  $environmentId: String!,
  $commitSha: String!
) {
  frontend: serviceInstanceDeployV2(
    serviceId: $frontendServiceId,
    environmentId: $environmentId,
    commitSha: $commitSha
  )
  backend: serviceInstanceDeployV2(
    serviceId: $backendServiceId,
    environmentId: $environmentId,
    commitSha: $commitSha
  )
}
"""

_deploy_lock = asyncio.Lock()


def _required_config() -> dict[str, str]:
    names = {
        "railway_token": "RAILWAY_API_TOKEN",
        "environment_id": "RAILWAY_ENVIRONMENT_ID",
        "frontend_service_id": "RAILWAY_FRONTEND_SERVICE_ID",
        "backend_service_id": "RAILWAY_BACKEND_SERVICE_ID",
        "trigger_token": "DEPLOY_TRIGGER_TOKEN",
    }
    values = {key: os.getenv(env_name, "").strip() for key, env_name in names.items()}
    missing = [names[key] for key, value in values.items() if not value]
    if missing:
        raise HTTPException(
            status_code=503,
            detail="Deployment endpoint is not configured: " + ", ".join(missing),
        )
    if len(values["trigger_token"]) < 32:
        raise HTTPException(
            status_code=503,
            detail="DEPLOY_TRIGGER_TOKEN must be at least 32 characters",
        )
    if values["frontend_service_id"] == values["backend_service_id"]:
        raise HTTPException(
            status_code=503,
            detail="Frontend and backend Railway service IDs must be different",
        )
    return values


@router.post("/both")
async def deploy_both_services(
    x_deploy_token: str | None = Header(default=None, alias="X-Deploy-Token"),
):
    """Deploy the latest commit on main to the two fixed Railway services."""
    config = _required_config()
    expected = config["trigger_token"].encode("utf-8")
    received = (x_deploy_token or "").encode("utf-8")
    if not hmac.compare_digest(received, expected):
        raise HTTPException(status_code=401, detail="Invalid deploy token")

    if _deploy_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="A two-service deployment request is already running",
        )

    async with _deploy_lock:
        timeout = httpx.Timeout(20.0, connect=8.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                github_response = await client.get(
                    GITHUB_COMMIT_URL,
                    headers={
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                        "User-Agent": "ZALUPA-deploy-shortcut",
                    },
                )
                github_response.raise_for_status()
                commit_sha = github_response.json()["sha"]
                if not isinstance(commit_sha, str) or len(commit_sha) != 40:
                    raise ValueError("GitHub returned an invalid commit SHA")
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                raise HTTPException(
                    status_code=502,
                    detail="Could not read the latest commit from GitHub",
                ) from exc

            variables = {
                "frontendServiceId": config["frontend_service_id"],
                "backendServiceId": config["backend_service_id"],
                "environmentId": config["environment_id"],
                "commitSha": commit_sha,
            }
            try:
                railway_response = await client.post(
                    RAILWAY_GRAPHQL_URL,
                    headers={
                        "Authorization": f"Bearer {config['railway_token']}",
                        "Content-Type": "application/json",
                    },
                    json={"query": DEPLOY_BOTH_MUTATION, "variables": variables},
                )
                railway_response.raise_for_status()
                railway_result = railway_response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise HTTPException(
                    status_code=502,
                    detail="Railway API request failed; check Railway deployment status before retrying",
                ) from exc

            if railway_result.get("errors"):
                # GraphQL can return partial data if one service deployment was
                # accepted and the other failed; callers should inspect Railway.
                raise HTTPException(
                    status_code=502,
                    detail={
                        "message": "Railway returned a deployment error; check both services before retrying",
                        "partial_data": railway_result.get("data"),
                    },
                )

            data = railway_result.get("data") or {}
            if not data.get("frontend") or not data.get("backend"):
                raise HTTPException(
                    status_code=502,
                    detail="Railway did not confirm both deployments; check Railway before retrying",
                )

    return {
        "status": "deployments_started",
        "commit_sha": commit_sha,
        "services": {
            "ZALUPA": data["frontend"],
            "sublime-dream": data["backend"],
        },
    }
