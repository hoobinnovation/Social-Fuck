import { AdapterError } from '../utils/errors';
import { fetchJson, fetchBuffer } from '../utils/http';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

export interface DriveUser {
  user?: { displayName?: string; emailAddress?: string; permissionId?: string };
}

export const getDriveUser = async (accessToken: string) => {
  const response = await fetchJson<DriveUser & { error?: { message: string } }>(
    `${DRIVE_BASE}/about?fields=user`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (response.status >= 400 || response.data.error) {
    throw new AdapterError('failed-precondition', response.data.error?.message ?? 'Drive about failed');
  }
  return response.data.user;
};

export const listFolderFiles = async (accessToken: string, folderId: string) => {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
      pageSize: '100',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const response = await fetchJson<{ files?: DriveFile[]; nextPageToken?: string; error?: { message: string } }>(
      `${DRIVE_BASE}/files?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (response.status >= 400 || response.data.error) {
      throw new AdapterError('failed-precondition', response.data.error?.message ?? 'Drive list files failed');
    }
    files.push(...(response.data.files ?? []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return files;
};

export const getFileMetadata = async (accessToken: string, fileId: string) => {
  const response = await fetchJson<DriveFile & { error?: { message: string } }>(
    `${DRIVE_BASE}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (response.status >= 400 || response.data.error) {
    throw new AdapterError('failed-precondition', response.data.error?.message ?? 'Drive file metadata failed');
  }
  return response.data as DriveFile;
};

export const downloadFile = async (accessToken: string, fileId: string) => {
  const response = await fetchBuffer(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: 60000,
  });
  if (response.status >= 400) {
    throw new AdapterError('failed-precondition', 'Drive download failed');
  }
  return response;
};
