import { HttpsError } from 'firebase-functions/v2/https';

export const assertTenantIds = (agencyId?: string, clientId?: string) => {
  if (!agencyId || !clientId) {
    throw new HttpsError('invalid-argument', 'Missing agencyId or clientId');
  }
};
