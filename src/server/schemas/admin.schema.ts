import { z } from 'zod';

export const deleteUserSchema = z.object({
  userId: z.uuidv4(),
});

export type DeleteUserInput = z.infer<typeof deleteUserSchema>;
