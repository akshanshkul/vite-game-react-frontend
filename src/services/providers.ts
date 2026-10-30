export type ProviderResult = {
  status: "completed" | "cancelled" | "unavailable";
  verified: false;
};
export interface RewardedAdProvider {
  show(consent: boolean): Promise<ProviderResult>;
}
export interface PurchaseProvider {
  purchase(productId: string, consent: boolean): Promise<ProviderResult>;
}
// Development mocks never grant server currency or real entitlements.
export class MockProviders implements RewardedAdProvider, PurchaseProvider {
  constructor(private enabled = false) {}
  async show(consent: boolean): Promise<ProviderResult> {
    return {
      status: !consent
        ? "cancelled"
        : this.enabled
          ? "completed"
          : "unavailable",
      verified: false,
    };
  }
  async purchase(
    _productId: string,
    consent: boolean,
  ): Promise<ProviderResult> {
    return this.show(consent);
  }
}
