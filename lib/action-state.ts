/**
 * Shared result shape for the form server actions.
 *
 * This lives outside the `"use server"` action modules on purpose: such a
 * module may only export async functions, so exporting the `idleState`
 * constant from one makes the whole module fail to load at runtime. The type
 * alone would be fine — types are erased — but the constant is not, so both
 * live here and the action modules import them.
 */
export type ActionState = { error: string | null };

export const idleState: ActionState = { error: null };
