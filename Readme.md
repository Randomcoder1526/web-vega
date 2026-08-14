# Vega Web — Render Deployment Guide

This guide explains how to deploy the Vega Web application on Render as a **Node.js Web Service**.

## Build Command

Use the following command:

```bash
npm install && chmod +x node_modules/.bin/vite && npm run build
```

This command:

1. Installs the project dependencies.
2. Gives the Vite executable permission to run.
3. Builds the frontend using Vite.

## Start Command

Use:

```bash
node server/index.mjs
```

This starts the Node.js server after the frontend build has completed.

## Important: Service Type

Set the Render service type to:

```text
Web Service
```

**Do not use:**

```text
Static Site
```

The application requires the Node.js server to handle SPA fallback routes such as `/admin`.

## Expected Deployment Flow

```text
GitHub
   ↓
Render Web Service
   ↓
npm install
   ↓
npm run build
   ↓
dist/
   ↓
node server/index.mjs
   ↓
/admin → Server SPA Fallback → dist/index.html
```

## Recommended Render Configuration

| Setting       | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| Service Type  | Web Service                                                       |
| Build Command | `npm install && chmod +x node_modules/.bin/vite && npm run build` |
| Start Command | `node server/index.mjs`                                           |
| Branch        | `main`                                                            |
| Node.js       | Recommended version defined by the project                        |

## SPA Route Handling

The Node.js server should serve the built frontend from the `dist/` directory.

Routes such as:

```text
/admin
/dashboard
/settings
```

should be handled by the server's SPA fallback and return:

```text
dist/index.html
```

This allows the frontend router to handle the route correctly.

## Deployment Checklist

Before deploying, verify:

* [ ] The repository is connected to Render.
* [ ] The service type is **Web Service**.
* [ ] The build command is correct.
* [ ] The start command is `node server/index.mjs`.
* [ ] The `dist/` folder is generated during the build.
* [ ] The server listens on Render's `PORT` environment variable.
* [ ] The server binds to `0.0.0.0`.
* [ ] SPA fallback is configured for frontend routes.
* [ ] Sensitive `.env` files and secrets are not committed to GitHub.

## Final Configuration

```text
Service Type:
Web Service

Build Command:
npm install && chmod +x node_modules/.bin/vite && npm run build

Start Command:
node server/index.mjs
```

After configuring these settings, deploy the latest commit from the `main` branch.
