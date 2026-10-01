# واجهة فيزانو بلص (Next.js) — للنشر على خادم خاص (deploy/ovh؛ 0005 §١٤٠). السياق: جذر المستودع.
FROM node:24-slim
ENV NEXT_TELEMETRY_DISABLED=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
# إعادة التوجيه تُثبَّت وقت البناء: /api/* → الخادم الداخلي، وطلبات المتصفح نسبية (أصل واحد، بلا CORS)
ARG STING_API_UPSTREAM=http://api:8000
ENV STING_API_UPSTREAM=${STING_API_UPSTREAM} NEXT_PUBLIC_API_URL=""
RUN pnpm install --frozen-lockfile && pnpm --filter @sting/web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@sting/web", "start"]
