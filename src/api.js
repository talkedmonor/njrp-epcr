const API = "/api";

export const getSession = () => {
  try {
    return JSON.parse(localStorage.getItem("njrp-session"));
  } catch {
    return null;
  }
};

export const setSession = (session) => localStorage.setItem("njrp-session", JSON.stringify(session));
export const clearSession = () => localStorage.removeItem("njrp-session");

export async function request(path, options = {}) {
  const session = getSession();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && session?.token) {
      clearSession();
      window.location.assign("/");
    }
    throw new Error(data.error || "Something went wrong");
  }
  return response.json();
}

export function pdfUrl(path) {
  const session = getSession();
  return `${API}${path}?token=${session?.token || ""}`;
}
