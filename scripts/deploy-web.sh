#!/usr/bin/env bash
# Build the frontend and publish it to the stack's S3 bucket + CloudFront.
# Bucket and distribution come from the SAM stack outputs (backend/template.yaml).
set -euo pipefail

STACK="${STACK:-accord-console}"
REGION="${REGION:-us-east-2}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(output SiteBucketName)"
DIST="$(output SiteDistributionId)"
if [ -z "$BUCKET" ] || [ "$BUCKET" = "None" ]; then
  echo "Stack $STACK has no SiteBucketName output. Run 'sam deploy' in backend/ first." >&2
  exit 1
fi

npx vite build
# Hashed assets first (long cache), then index.html with no-cache so new builds load at once.
aws s3 sync dist "s3://$BUCKET" --delete --exclude index.html --region "$REGION"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache" --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths /index.html >/dev/null

echo "Published: $(output SiteUrl)"
