FROM python:3.11-slim

WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com Pillow==10.4.0

ENV PORT=8080
EXPOSE 8080

CMD ["python", "server.py"]
