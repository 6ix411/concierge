import { notFound } from "next/navigation";
import { z } from "zod";

const guid = z.guid();

export const isId = (value: unknown): value is string => guid.safeParse(value).success;

/**
 * For pages: an id from the URL must look like one before it reaches a query. Anything else is a
 * plain 404, the same as an id that exists but belongs to someone else.
 */
export function pageId(value: string): string {
  if (!isId(value)) notFound();
  return value;
}
