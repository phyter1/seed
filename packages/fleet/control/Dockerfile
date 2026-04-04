FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --production
COPY src/ src/
EXPOSE 4310
VOLUME /data
CMD ["bun", "run", "src/main.ts"]
