SELECT net.http_post(
    url:='https://httpbin.org/post',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:='{"test": true}'::jsonb
);
