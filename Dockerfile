# Local debug image for cargo-tracker (NestJS API + Vite web).
# Runs `npm run dev`: NestJS in watch mode on :3001 and Vite (HMR) on :5173.
# For production deployment use Vercel (see README) — this image is for local
# development / debugging in a clean, reproducible environment.
FROM node:20-bookworm-slim

WORKDIR /app

# Install deps first for better layer caching. With docker compose the project
# source is bind-mounted, so this layer is reused until package.json changes.
COPY package*.json ./
RUN npm install

# Copy the rest of the source. Used for a plain `docker run` without a bind
# mount; with docker compose the bind mount shadows this with live files.
COPY . .

# 5173 = Vite dev server (open this in the browser); 3001 = NestJS API.
EXPOSE 5173 3001

# DEMO_MODE on by default so the app works fully offline inside the container.
ENV DEMO_MODE=true

CMD ["npm", "run", "dev"]
