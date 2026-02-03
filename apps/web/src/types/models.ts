export type UserRole = "owner" | "admin" | "editor" | "approver" | "viewer";

export interface Client {
  id: string;
  name: string;
  timezone: string;
  status: "active" | "archived";
  createdAt?: string;
  updatedAt?: string;
}

export interface Asset {
  id: string;
  type: "image" | "video";
  storagePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  source: "upload" | "drive";
  downloadUrl?: string;
  createdAt?: string;
  deletedAt?: string | null;
}

export interface Variant {
  id: string;
  platform: "facebook" | "instagram" | "youtube" | "tiktok";
  text: string;
  assetRefs: string[];
  settings?: Record<string, unknown>;
}

export interface Post {
  id: string;
  title: string;
  status: "draft" | "in_review" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Schedule {
  id: string;
  publishAt: string;
  status: "scheduled" | "pending" | "published" | "failed";
  createdAt?: string;
  updatedAt?: string;
}

export interface Connection {
  id: string;
  platform: "meta" | "youtube" | "tiktok" | "drive";
  status: "connected" | "disconnected" | "error" | "pending";
  displayName?: string;
  accountId?: string;
  scopes?: string[];
  updatedAt?: string;
}

export interface LogEntry {
  id: string;
  platform: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
  at?: string;
}
