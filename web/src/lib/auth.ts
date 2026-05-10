import { User } from "./api";

export function getCurrentUser(): User | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function isAdmin(): boolean {
  return getCurrentUser()?.role === "admin";
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}
