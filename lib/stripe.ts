export type StripePaymentEvent = {
  type?: string;
  data?: {
    object?: {
      amount_total?: number;
      amount_received?: number;
      amount?: number;
      amount_refunded?: number;
      refunded?: boolean;
      payment_status?: string;
    };
  };
};

export function isFullStripeRefund(event: StripePaymentEvent) {
  const object = event.data?.object;
  return event.type === "charge.refunded" && object?.refunded === true &&
    typeof object.amount === "number" && object.amount_refunded === object.amount;
}

export function isConfirmedStripePayment(event: StripePaymentEvent) {
  const type = event.type ?? "";
  const object = event.data?.object;
  if (type === "payment_intent.succeeded") return true;
  return (
    type === "checkout.session.completed" && object?.payment_status === "paid"
  );
}

export function stripeEventAmountSek(event: StripePaymentEvent) {
  const object = event.data?.object;
  return event.type === "payment_intent.succeeded"
    ? object?.amount_received
    : object?.amount_total;
}
