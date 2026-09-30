import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getOwnEmailConnectionWithToken: vi.fn(),
  decryptRefreshToken: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnEmailConnectionWithToken: mocks.getOwnEmailConnectionWithToken,
  decryptRefreshToken: mocks.decryptRefreshToken,
}));

vi.mock('@career-os/email', () => ({
  revokeToken: mocks.revokeToken,
}));

const { purgeAccountExternalData } = await import('./account-deletion');

const USER_ID = '22222222-2222-4222-8222-222222222222';

function adminWithStorage(pages: { name: string }[][]) {
  const list = vi.fn();
  for (const page of pages) list.mockResolvedValueOnce({ data: page, error: null });
  list.mockResolvedValue({ data: [], error: null });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const from = vi.fn().mockReturnValue({ list, remove });
  return { admin: { storage: { from } } as never, list, remove, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('purgeAccountExternalData', () => {
  it('revokes the Gmail grant when a connection exists', async () => {
    mocks.getOwnEmailConnectionWithToken.mockResolvedValue({ encryptedRefreshToken: 'enc' });
    mocks.decryptRefreshToken.mockReturnValue('refresh-token');
    const { admin } = adminWithStorage([]);

    await purgeAccountExternalData({} as never, admin, USER_ID);

    expect(mocks.getOwnEmailConnectionWithToken).toHaveBeenCalledWith({}, USER_ID);
    expect(mocks.revokeToken).toHaveBeenCalledWith('refresh-token');
  });

  it('skips revocation (without failing) when there is no connection or the token cannot be decrypted', async () => {
    mocks.getOwnEmailConnectionWithToken.mockResolvedValueOnce(null);
    await purgeAccountExternalData({} as never, adminWithStorage([]).admin, USER_ID);
    expect(mocks.revokeToken).not.toHaveBeenCalled();

    mocks.getOwnEmailConnectionWithToken.mockResolvedValueOnce({ encryptedRefreshToken: 'bad' });
    mocks.decryptRefreshToken.mockImplementationOnce(() => {
      throw new Error('bad key');
    });
    await expect(
      purgeAccountExternalData({} as never, adminWithStorage([]).admin, USER_ID),
    ).resolves.toBeUndefined();
    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it("removes every object under the user's own résumé-upload folder, page by page", async () => {
    mocks.getOwnEmailConnectionWithToken.mockResolvedValue(null);
    const { admin, list, remove, from } = adminWithStorage([
      [{ name: 'a.pdf' }, { name: 'b.pdf' }],
      [{ name: 'c.pdf' }],
    ]);

    await purgeAccountExternalData({} as never, admin, USER_ID);

    expect(from).toHaveBeenCalledWith('resume-uploads');
    expect(list).toHaveBeenCalledWith(USER_ID, expect.any(Object));
    expect(remove).toHaveBeenNthCalledWith(1, [`${USER_ID}/a.pdf`, `${USER_ID}/b.pdf`]);
    expect(remove).toHaveBeenNthCalledWith(2, [`${USER_ID}/c.pdf`]);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('throws when storage removal fails, so the caller never deletes the account half-way', async () => {
    mocks.getOwnEmailConnectionWithToken.mockResolvedValue(null);
    const { admin, remove } = adminWithStorage([[{ name: 'a.pdf' }]]);
    remove.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    await expect(purgeAccountExternalData({} as never, admin, USER_ID)).rejects.toThrow('boom');
  });
});
