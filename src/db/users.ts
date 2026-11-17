import { db } from './index.ts';
import { systemSettings, telegramSettings, users } from './schema.ts';
import { eq } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string, displayName?: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName ?? email.split('@')[0],
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName: displayName ?? undefined,
          updatedAt: new Date(),
        },
      })
      .returning();

    const user = result[0];

    // Ensure default settings rows exist for this user
    await db
      .insert(systemSettings)
      .values({
        userId: user.id,
      })
      .onConflictDoNothing({ target: systemSettings.userId });

    await db
      .insert(telegramSettings)
      .values({
        userId: user.id,
      })
      .onConflictDoNothing({ target: telegramSettings.userId });

    return user;
  } catch (error) {
    console.error('Database error in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user profile.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database error in getUserByUid:', error);
    throw new Error('Failed to fetch user profile.', { cause: error });
  }
}
