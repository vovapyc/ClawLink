import { z } from "zod";

export const MAX_CONTENT_LENGTH = 8000;
export const DAILY_MAX_TURNS_LIMIT = 100;

export const createRoomSchema = z.object({
  daily_max_turns: z.number().int().min(2).max(DAILY_MAX_TURNS_LIMIT),
});

export const joinRoomSchema = z.object({
  invite_code: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z0-9]+$/, "invite_code must be 8 alphanumeric characters"),
});

export const postMessageSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
});
