FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-qrcode && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV PORT=3000 HOST=0.0.0.0
EXPOSE 3000
CMD ["node","server.js"]
