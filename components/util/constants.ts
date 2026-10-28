// SPDX-License-Identifier: Apache-2.0
// Plain module (no 'use client'): safe to import from server and client components alike.
// A constant exported from a client module would reach a server component as a client
// reference proxy, not a value.

/** Rows per page in the draw-history table. */
export const HISTORY_PAGE = 25
