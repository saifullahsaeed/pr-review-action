declare function sendCharge(amount: number): Promise<void>;

export async function chargeInvoice(invoiceId: string, amount: number): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await sendCharge(amount);
      return true;
    } catch (error) {
      // retry on timeout
    }
  }
  return false;
}
