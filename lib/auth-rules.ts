// Rol kararı (saf fonksiyon, test edilebilir): e-postası doğrulanmamış kullanıcı hiçbir rol almaz.
export type Role = "viewer" | "editor" | "admin";
export type AuthUser = { email?: string | null; email_confirmed_at?: string | null } | null | undefined;

export async function resolveRole(user: AuthUser, adminEmail: string | undefined, lookup: (email: string) => Promise<Role | null>): Promise<{ email: string; role: Role } | null> {
  const email = user?.email?.toLowerCase();
  if (!email || !user?.email_confirmed_at) return null;
  if (adminEmail && email === adminEmail.toLowerCase()) return { email, role: "admin" };
  const role = await lookup(email);
  return role ? { email, role } : null;
}
