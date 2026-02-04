import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { HttpsError } from 'firebase-functions/v2/https';

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  obtained_at: number;
}

const client = new SecretManagerServiceClient();

const getProjectId = () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) {
    throw new HttpsError('failed-precondition', 'Missing GCP project id');
  }
  return projectId;
};

export const storeToken = async (secretId: string, token: StoredToken) => {
  const projectId = getProjectId();
  const parent = `projects/${projectId}`;
  const secretName = `${parent}/secrets/${secretId}`;
  try {
    await client.getSecret({ name: secretName });
  } catch {
    await client.createSecret({
      parent,
      secretId,
      secret: {
        replication: { automatic: {} },
      },
    });
  }
  await client.addSecretVersion({
    parent: secretName,
    payload: {
      data: Buffer.from(JSON.stringify(token), 'utf8'),
    },
  });
  return secretName;
};

export const accessToken = async (secretName: string): Promise<StoredToken> => {
  const [version] = await client.accessSecretVersion({
    name: `${secretName}/versions/latest`,
  });
  const payload = version.payload?.data?.toString('utf8');
  if (!payload) {
    throw new HttpsError('failed-precondition', 'Missing stored token');
  }
  return JSON.parse(payload) as StoredToken;
};

export const deleteToken = async (secretName: string) => {
  await client.deleteSecret({ name: secretName });
};
