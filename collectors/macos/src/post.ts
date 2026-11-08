export async function postEnvelope(url: string, token: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status !== 202) {
    throw new Error(`macos ingest responded ${response.status}`);
  }
}
