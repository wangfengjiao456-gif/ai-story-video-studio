FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home renderer
WORKDIR /app
COPY renderer/ /app/
USER renderer
ENV PORT=8000
EXPOSE 8000
CMD ["python", "server.py"]
