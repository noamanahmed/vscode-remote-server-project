# Use Python 3.12 Alpine as the base image
FROM python:3.12-alpine

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies
# ripgrep is required for search operations
# build-base and libffi-dev are needed for some python package compilations
RUN apk add --no-cache ripgrep build-base libffi-dev

# Set the working directory
WORKDIR /app

# Copy requirements and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the daemon code
COPY . .

# Expose the port the daemon runs on
EXPOSE 8765

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765", "--token", "verySecureToken@Ooops"]
