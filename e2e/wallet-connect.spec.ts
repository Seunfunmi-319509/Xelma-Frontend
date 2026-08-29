import { test, expect } from '@playwright/test';

const MOCK_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFOEL';

/**
 * Inject a fake Freighter wallet plus the extension's postMessage bridge.
 *
 * `@stellar/freighter-api@6` talks to the extension over `postMessage`
 * (`FREIGHTER_EXTERNAL_MSG_REQUEST` / `..._RESPONSE`) rather than invoking
 * methods on `window.freighter`, so we must answer those messages ourselves to
 * drive the connect/auth flow deterministically in a headless browser.
 */
function mockFreighter(page: import('@playwright/test').Page) {
  return page.addInitScript((address: string) => {
    // Keep `window.freighter` present so `isConnected()` short-circuits to
    // truthy without waiting on extension messaging.
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve({ isConnected: true }),
      requestAccess: () => Promise.resolve({ address, error: null }),
      getAddress: () => Promise.resolve({ address, error: null }),
  return page.addInitScript((mockAddress: string) => {
    let connected = false;
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve({ isConnected: connected }),
      requestAccess: () => {
        connected = true;
        return Promise.resolve({ address: mockAddress, error: null });
      },
      getAddress: () =>
        Promise.resolve({ address: mockAddress, error: null }),
      getNetwork: () => Promise.resolve({ network: 'TESTNET', error: null }),
      signMessage: (message: string, opts: { address?: string; networkPassphrase?: string }) =>
        Promise.resolve({
          signedMessage: `mocked_signature_${message}`,
          signerAddress: opts?.address ?? address,
          error: null,
        }),
    };

    // Answer FREIGHTER_EXTERNAL_MSG_RESPONSE for every request the API posts.
    // Runs on a microtask/task so the API has registered its own `message`
    // listener before we dispatch the synthetic response.
    const handleRequest = (data: Record<string, unknown>) => {
      const type = data.type as string;
      const messageId = data.messageId as string;

      const payloads: Record<string, Record<string, unknown>> = {
        // Check public key without authorizing -> empty (user not connected yet).
        REQUEST_PUBLIC_KEY: { publicKey: '', error: null },
        // Explicit connect flow authorizes and returns the mock address.
        REQUEST_ACCESS: { publicKey: address, error: null },
        REQUEST_ALLOWED_STATUS: { isAllowed: true, error: null },
        REQUEST_NETWORK: {
          network: 'TESTNET',
          networkPassphrase: 'Test SDF Network ; September 2015',
          error: null,
        },
        REQUEST_CONNECTION_STATUS: { isConnected: true },
        SUBMIT_BLOB: {
          signedBlob: `mocked_signature_${type}`,
          signerAddress: address,
          error: null,
        },
      };

      const payload = payloads[type] ?? {};

      setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
              messagedId: messageId,
              ...payload,
            },
            source: window,
          }),
        );
      }, 0);
    };

    // The API dispatches requests via postMessage; intercept those calls.
    window.postMessage = (message: unknown) => {
      const data = message as Record<string, unknown>;
      if (data?.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
        handleRequest(data);
      }
    };
  }, MOCK_ADDRESS);
}

test.describe('Wallet Connect – Freighter Mocked', () => {
  test('Connect page shows wallet prompt and Connect Wallet button', async ({ page }) => {
    await mockFreighter(page);

    // Mock Horizon balance request
    await page.route('**/horizon-testnet.stellar.org/accounts/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balances: [{ asset_type: 'native', balance: '100.00' }],
        }),
      }),
    );

    // Mock backend auth endpoints
    await page.route('**/api/auth/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ challenge: 'mock_challenge', token: 'mock_jwt_token' }),
      }),
    );

    await page.goto('/connect');

    // The Connect page renders the WalletConnect component. Scope to the card so we
    // don't collide with the Navbar's own "Connect Wallet" button.
    const connectButton = page
      .locator('.glass-card')
      .getByRole('button', { name: /connect wallet/i });
    // The Connect page renders the WalletConnect component
    // Specify the button in the header (desktop), not the mobile drawer
    const connectButton = page.locator('header button:has-text("Connect Wallet")').first();
    await expect(connectButton).toBeVisible();
  });

  test('Dashboard shows wallet prompt when not connected, then navigates to connect page', async ({ page }) => {
    await mockFreighter(page);

    // Mock Horizon balance request
    await page.route('**/horizon-testnet.stellar.org/accounts/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balances: [{ asset_type: 'native', balance: '100.00' }],
        }),
      }),
    );

    // Mock backend auth endpoints
    await page.route('**/api/auth/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ challenge: 'mock_challenge', token: 'mock_jwt_token' }),
      }),
    );

    await page.goto('/dashboard');

    // Dismiss the first-visit onboarding checklist if it is shown; its full-screen
    // overlay would otherwise intercept clicks on the dashboard.
    const onboardingDismiss = page.getByRole('button', { name: /let's go/i });
    if (await onboardingDismiss.isVisible().catch(() => false)) {
      await onboardingDismiss.click();
    }

    // Should show wallet prompt when not connected
    const walletPrompt = page.locator('[data-testid="dashboard-wallet-prompt"]');
    await expect(walletPrompt).toBeVisible();
    await expect(walletPrompt).toContainText('Connect your wallet');

    // Navigate to /connect page
    await page.goto('/connect');

    // Close any modal overlay that might be present (e.g., onboarding modal)
    const modalOverlay = page.locator('.fixed.inset-0.z-\\[200\\]');
    if (await modalOverlay.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Click "Connect Wallet" button to open the wallet picker
    const connectButton = page
      .locator('.glass-card')
      .getByRole('button', { name: /connect wallet/i });
    await expect(connectButton).toBeVisible();
    await connectButton.click();

    // Select Freighter from the wallet picker to initiate the connection flow
    const freighterOption = page.getByRole('button', { name: /freighter/i });
    await expect(freighterOption).toBeVisible();
    await freighterOption.click();

    // After connection, the "Continue to Dashboard" button should appear
    const continueBtn = page.getByRole('button', { name: /continue to dashboard/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    // Verify Connect Wallet button is visible on the connect page
    const connectButton = page.getByRole('button', { name: 'Connect Wallet' }).nth(1);
    await expect(connectButton).toBeVisible();
  });
});
