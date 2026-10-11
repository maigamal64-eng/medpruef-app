export async function fetchAdminAccess(fetcher: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher();
      if (response.status < 500 || attempt === 1) return response;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error("Access check unavailable");
}
