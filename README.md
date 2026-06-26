# MacroLeia

MacroLeia is a small web app for saving, organizing, and copying personal text macros. It was designed for narrow browser windows so it can stay side by side with another app while troubleshooting, supporting customers, or repeating structured text workflows.

The app is protected by login, keeps each user's macros isolated, and can run locally with SQLite or in Google Cloud Run with Firestore.

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Local Setup](#local-setup)
- [Running Tests](#running-tests)
- [Docker](#docker)
- [Cloud Run Deployment](#cloud-run-deployment)
- [Environment Variables](#environment-variables)
- [Static Assets](#static-assets)
- [API Overview](#api-overview)
- [Security Notes](#security-notes)
- [Development Notes](#development-notes)
- [License](#license)

## Features

- User registration with username, email, and password.
- Login with HTTP-only session cookie.
- Password reset using username, email, and a new password.
- User-isolated macro data.
- Macro list with create, edit, rename, delete, reorder actions, and `S`/`M` type badges.
- Up/down reorder buttons that disable at the first and last positions.
- Single-message macros copy directly from the list and show the same centered `Copiado` toast used by multi-message macros.
- Multi-message macros open a detail screen with numbered, resizable preview buttons.
- Each numbered button copies its stored message to the clipboard.
- Macro editor starts new macros with one text field and lets users add, remove, and reorder text cards as needed.
- Dark, compact, responsive layout optimized for narrow windows.
- Home screen keeps the top area minimal by showing the logo and actions without a redundant `Macros` heading.
- Custom logo support and a small fixed `poweredby` image.
- FastAPI backend with SQLite for local development.
- Firestore support for Cloud Run deployments.
- Dockerfile and Cloud Build config ready for Google Cloud Run.

## How It Works

1. The user creates an account or logs in.
2. The home screen shows the logo, user/actions, and only that user's macros without an extra list title.
3. Each macro row includes a small type badge:
   - `S` means the macro has zero or one filled text and behaves as a single-copy macro.
   - `M` means the macro has multiple filled texts and opens the multi-option detail screen.
4. A macro can contain one or more text messages:
   - If it has one filled message, clicking the macro copies it immediately.
   - If it has multiple filled messages, clicking the macro opens a detail screen.
5. In the macro editor, text cards can be moved up or down before saving, changing the sequence shown in the detail screen.
6. In the detail screen, each button shows its sequence number plus a truncated preview of the saved text.
7. Preview buttons can be resized vertically to reveal more text while keeping the compact default layout.
8. Clicking a message button copies the full text to the clipboard and shows a centered `Copiado` toast.

## Tech Stack

- **Backend:** Python 3.12, FastAPI, Uvicorn, Pydantic.
- **Local storage:** SQLite.
- **Cloud storage:** Google Cloud Firestore.
- **Frontend:** Static HTML, CSS, and vanilla JavaScript.
- **Deployment:** Docker, Google Cloud Build, Google Cloud Run.
- **Tests:** Pytest with FastAPI TestClient.

## Project Structure

```text
MacroLeia/
  backend/
    app/
      __init__.py
      main.py
    tests/
      test_api.py
    __init__.py
    requirements.txt
    requirements-dev.txt
  frontend/
    static/
      app.js
      index.html
      logo.png
      poweredby.png
      styles.css
  data/
    .gitkeep
  .dockerignore
  .gitignore
  cloudbuild.yaml
  Dockerfile
  README.md
```

## Requirements

- Python 3.12 or newer.
- Git.
- Docker, if running the container locally.
- Google Cloud CLI, only when deploying to Cloud Run.
- A Google Cloud project with Cloud Build, Artifact Registry, Cloud Run, and Firestore enabled for production deployment.

## Local Setup

From PowerShell:

```powershell
cd C:\CodeProjects\MacroLeia
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Open the app at:

```text
http://127.0.0.1:8000
```

By default, local data is stored in:

```text
data/macroleia.db
```

The SQLite database file is ignored by Git.

## Running Tests

Install development dependencies:

```powershell
cd C:\CodeProjects\MacroLeia
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements-dev.txt
```

Run the automated API tests:

```powershell
python -B -m pytest backend\tests -q -p no:cacheprovider
```

## Docker

Build the image:

```powershell
cd C:\CodeProjects\MacroLeia
docker build -t macroleia .
```

Run with a local data volume:

```powershell
docker run --rm -p 8080:8080 -v ${PWD}\data:/app/data macroleia
```

Open:

```text
http://127.0.0.1:8080
```

## Cloud Run Deployment

The repository includes:

- `Dockerfile` for the production container image.
- `cloudbuild.yaml` for Cloud Build image creation, Artifact Registry push, and Cloud Run deploy.

Current Cloud Build substitutions:

```yaml
substitutions:
  _REGION: us-central1
  _REPOSITORY: cloud-run-source-deploy
```

The Cloud Run deployment is configured with:

- `--min-instances 0` so the service can scale to zero when idle.
- `--allow-unauthenticated` so the web app is reachable publicly while application data remains behind login.
- `MACROLEIA_STORAGE=firestore` so data persists outside the container.

Deploy command:

```powershell
gcloud builds submit --config cloudbuild.yaml .
```

Production URL currently used by the project:

```text
https://macroleia-753430801062.us-central1.run.app/
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` in Docker | Port used by Uvicorn inside the container. |
| `MACROLEIA_DB` | `data/macroleia.db` locally, `/app/data/macroleia.db` in Docker | SQLite database path. |
| `MACROLEIA_STORAGE` | `sqlite` | Storage backend. Use `sqlite` locally or `firestore` on Cloud Run. |

## Static Assets

Static frontend files are served from `frontend/static`.

- `frontend/static/logo.png`: main responsive logo shown at the top of the app.
- `frontend/static/poweredby.png`: small fixed image shown in the bottom-right corner.
- `frontend/static/styles.css`: dark responsive layout.
- `frontend/static/app.js`: frontend state, rendering, API calls, and clipboard behavior.

To replace the logo or powered-by image, keep the same filenames and place the PNG files in `frontend/static`.

## API Overview

All user and macro operations are exposed under `/api`.

### Authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create user and start a session. |
| `POST` | `/api/auth/login` | Log in and start a session. |
| `POST` | `/api/auth/logout` | Log out and clear the session. |
| `POST` | `/api/auth/reset-password` | Reset password using username and email. |
| `GET` | `/api/me` | Return the current logged-in user. |

### Macros

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/macros` | List macros for the logged-in user. |
| `POST` | `/api/macros` | Create a macro. |
| `GET` | `/api/macros/{macro_id}` | Get one macro. |
| `PUT` | `/api/macros/{macro_id}` | Update a macro. |
| `DELETE` | `/api/macros/{macro_id}` | Delete a macro. |
| `POST` | `/api/macros/{macro_id}/reorder` | Move a macro up or down. |

### API Usage Examples

The API uses an HTTP-only session cookie. When testing with `curl`, use a cookie jar so authenticated requests can reuse the session created by register or login.

Set a base URL:

```bash
BASE_URL="https://macroleia-753430801062.us-central1.run.app"
```

Register a user and save the session cookie:

```bash
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_user","email":"demo@example.com","password":"secret123"}' \
  "$BASE_URL/api/auth/register"
```

Log in with an existing user:

```bash
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_user","password":"secret123"}' \
  "$BASE_URL/api/auth/login"
```

Check the current session:

```bash
curl -b cookies.txt "$BASE_URL/api/me"
```

Create a single-message macro:

```bash
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Greeting",
    "buttons": [
      { "label": "1", "message": "Hello! How can I help you today?" }
    ]
  }' \
  "$BASE_URL/api/macros"
```

Create a multi-message macro:

```bash
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Troubleshooting",
    "buttons": [
      { "label": "1", "message": "Please restart the application and try again." },
      { "label": "2", "message": "Please confirm whether the issue also happens in an incognito window." },
      { "label": "3", "message": "I will escalate this with the details collected so far." }
    ]
  }' \
  "$BASE_URL/api/macros"
```

List macros:

```bash
curl -b cookies.txt "$BASE_URL/api/macros"
```

Get one macro:

```bash
curl -b cookies.txt "$BASE_URL/api/macros/MACRO_ID"
```

Update a macro:

```bash
curl -X PUT -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Troubleshooting",
    "buttons": [
      { "label": "1", "message": "Please restart the application and try again." },
      { "label": "2", "message": "Please send a screenshot of the error message." }
    ]
  }' \
  "$BASE_URL/api/macros/MACRO_ID"
```

Move a macro up or down in the list:

```bash
curl -X POST -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"direction":"up"}' \
  "$BASE_URL/api/macros/MACRO_ID/reorder"
```

Delete a macro:

```bash
curl -X DELETE -b cookies.txt "$BASE_URL/api/macros/MACRO_ID"
```

Reset a password:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_user","email":"demo@example.com","new_password":"newsecret123"}' \
  "$BASE_URL/api/auth/reset-password"
```

Log out:

```bash
curl -X POST -b cookies.txt -c cookies.txt "$BASE_URL/api/auth/logout"
```

## Security Notes

- Passwords are stored as salted hashes, not as plain text.
- Sessions use an HTTP-only cookie.
- Users can only access their own macros through authenticated API routes.
- Password reset currently validates username and email, then accepts a new password directly.
- Email confirmation and email-based reset links are intentionally not implemented yet.
- The app is publicly reachable on Cloud Run, but application data remains behind login.

## Development Notes

- Keep changes focused and avoid unrelated refactors.
- After every code change, review this README and update it if behavior, setup, deployment, assets, tests, or API details changed.
- Do not commit local database files from `data/`.
- Run the API tests before publishing code changes.
- For Cloud Run, use Firestore instead of SQLite because containers can scale to zero and should not rely on local container storage.
- Clipboard writes require a browser context that allows the Clipboard API, such as HTTPS or localhost.

## License

This software is not currently available for third-party licensing. All rights are reserved unless a separate license is provided later.
