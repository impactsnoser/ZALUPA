# One-tap Railway deploy shortcut

The backend exposes `POST /api/deploy/both`. It reads the current commit SHA
from `main` in `impactsnoser/ZALUPA`, then asks Railway to deploy that same
commit to the configured frontend and backend services.

## Configure the backend service in Railway

Add these variables to the `sublime-dream` backend service in the target
Railway environment:

| Variable | Value |
| --- | --- |
| `RAILWAY_API_TOKEN` | A Railway project token scoped to the target environment |
| `RAILWAY_ENVIRONMENT_ID` | ID of the environment to deploy |
| `RAILWAY_FRONTEND_SERVICE_ID` | Service ID for `ZALUPA` |
| `RAILWAY_BACKEND_SERVICE_ID` | Service ID for `sublime-dream` |
| `DEPLOY_TRIGGER_TOKEN` | A private random value of at least 32 characters |

Keep all values out of Git. The Railway API token belongs only in the backend
service variables; the Android shortcut uses only `DEPLOY_TRIGGER_TOKEN`.

After saving the variables, redeploy `sublime-dream` once so the backend loads
them. The Railway service IDs and environment ID are visible in the relevant
Railway dashboard URLs.

## Create the Android home-screen button

In HTTP Shortcuts, create a shortcut with:

- Method: `POST`
- URL: `https://<sublime-dream-public-domain>/api/deploy/both`
- Header: `X-Deploy-Token: <the same DEPLOY_TRIGGER_TOKEN>`
- Body: empty

Use the app's home-screen widget/shortcut flow to place it on the M12 desktop.
The endpoint fixes the repository, branch, environment, and two service IDs on
the server; request parameters cannot redirect the deployment elsewhere.

## Response behavior

A successful response contains `status: deployments_started`, the commit SHA,
and the Railway IDs returned for both deployment requests. A `401` means the
shortcut token is wrong. A `503` means a required Railway variable is missing
or invalid. A `502` means GitHub or Railway did not confirm the request; check
both services in Railway before retrying, because one deployment may have
started even when the other failed.
