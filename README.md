# F1 Backend Server

A simple Express server to fetch F1 data.

## Setup

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Install dependencies (if not already done):
   ```bash
   npm install
   ```
3. Start the server (Production):
   ```bash
   npm start
   ```
4. Start the server (Development with auto-reload):
   ```bash
   npm run dev
   ```

## Database Setup

The server uses PostgreSQL. Ensure your `.env` file has the following variables:
- `PG_USER`, `PG_PASSWORD`, `PG_HOST`, `PG_DATABASE`

## API Routes

- `GET /health`: Server health check.
- `GET /db-test`: Database connectivity test.
- `GET /get-all-constructors`: Fetches all constructors from the local database.
- `GET /constructors`: Fetches the 2026 constructor standings from Ergast API.
# pitwall-backend
