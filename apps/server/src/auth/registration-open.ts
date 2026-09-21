/** First account may always register so a closed instance can still be bootstrapped. */
export async function isRegistrationOpen(
  prisma: { user: { count: () => Promise<number> } },
  registrationEnabled: boolean,
): Promise<boolean> {
  if (registrationEnabled) return true;
  return (await prisma.user.count()) === 0;
}
