export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/((?!api/auth|api/nexus|health|login|access-denied|_next/static|_next/image|favicon.ico).*)"]
};
