FROM node:20-bookworm-slim

WORKDIR /app

# O conversor legado tools/sacibin2txt eh um ELF 32-bit.
# Em ambiente Linux moderno 64-bit ele precisa do loader/bibliotecas 32-bit.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libc6-i386 lib32stdc++6 tesseract-ocr tesseract-ocr-por \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x /app/tools/sacibin2txt

ENV NODE_ENV=production
CMD ["npm", "start"]
