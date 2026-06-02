Deployment to Render — WA QuickReply Backend

1) Create a new Web Service on Render
   - Connect your GitHub repo
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Health Check Path: `/health`

2) Configure Environment Variables (use the Render dashboard secrets):
   - `PORT`=10000 (optional)
   - `MONGODB_URI` (MongoDB connection string)
   - `OPENAI_API_KEY` (OpenAI API key)
   - `RESEND_API_KEY` (Resend API key)
   - `JWT_SECRET` (strong secret)
   - `REFRESH_TOKEN_SECRET` (strong secret)
   - `PADDLE_WEBHOOK_SECRET` (paddle secret)
   - `ADMIN_SECRET` (admin promotion secret)
   - `ADMIN_EMAIL` (optional owner email)
   - `SUPER_ADMIN_PASSWORD` (optional seed password)
   - `SUPER_ADMIN_ID` (optional seeded super admin id)
   - `FRONTEND_URL` (production frontend URL)
   - `NODE_ENV`=production

3) After deploy
   - Verify `/health` returns 200
   - Verify DB seed created the Super Admin using `ADMIN_EMAIL`
   - Verify `/auth/features` returns the feature matrix
   - Verify SSE endpoints `/events?email=...` and `/admin-events?token=...` work

4) Recommended logging/monitoring
   - Add Render log drains or any log aggregation
   - Monitor OpenAI and Resend usage

5) Rollback plan
   - Use Render deploy history to rollback

Commands to test locally

```bash
# install deps
npm install
# start locally with .env
node server.js
# or use nodemon
npx nodemon server.js
```
