export default {
  fetch(): Response {
    return new Response('Service temporarily unavailable during deployment.', {
      status: 503,
      headers: { 'Retry-After': '60' },
    });
  },
  scheduled(): void {},
} satisfies ExportedHandler;
