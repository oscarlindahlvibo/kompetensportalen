export type BankIdVerification = {
  status: "pending" | "verified" | "failed";
  reference?: string;
  personalNumberVerified?: boolean;
  personalNumber?: string;
  fullName?: string;
};
export type Id06RegistrationRequest = {
  certificateId: string;
  competenceCode: string;
  competenceName: string;
  validUntil: string | null;
};

export type BankIdRuntime = {
  BANKID_PROVIDER?: string;
  BANKID_API_BASE_URL?: string;
  BANKID_API_TOKEN?: string;
  BANKID_START_PATH?: string;
  BANKID_COLLECT_PATH?: string;
};

export function bankIdResultIsVerified(result: BankIdVerification) {
  return result.status === "verified" && result.personalNumberVerified === true && Boolean(result.personalNumber);
}

export interface BankIdAdapter {
  startVerification(input: {
    userId: string;
    enrollmentId: string;
  }): Promise<{ orderRef: string; autoStartToken?: string }>;
  collectVerification(orderRef: string): Promise<BankIdVerification>;
}

export interface Id06Adapter {
  submitRegistration(
    input: Id06RegistrationRequest,
  ): Promise<{ reference: string }>;
}

export class ManualBankIdAdapter implements BankIdAdapter {
  async startVerification() {
    return { orderRef: `manual_${crypto.randomUUID()}` };
  }
  async collectVerification() {
    return { status: "pending" as const };
  }
}

/**
 * Provider-neutral HTTP contract. A concrete BankID provider can be used by
 * configuring its adapter-compatible start and collect endpoints; provider
 * specific SDKs should implement BankIdAdapter instead of changing course logic.
 */
export class HttpBankIdAdapter implements BankIdAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly startPath = "/verification/start",
    private readonly collectPath = "/verification/{orderRef}",
  ) {}

  async startVerification(input: { userId: string; enrollmentId: string }) {
    const response = await fetch(new URL(this.startPath, this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok)
      throw new Error(`BankID provider returned ${response.status}`);
    const data = (await response.json()) as {
      orderRef?: string;
      autoStartToken?: string;
    };
    if (!data.orderRef)
      throw new Error("BankID provider did not return orderRef");
    return { orderRef: data.orderRef, autoStartToken: data.autoStartToken };
  }

  async collectVerification(orderRef: string) {
    const path = this.collectPath.replace(
      "{orderRef}",
      encodeURIComponent(orderRef),
    );
    const response = await fetch(new URL(path, this.baseUrl), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        accept: "application/json",
      },
    });
    if (!response.ok)
      throw new Error(`BankID provider returned ${response.status}`);
    const data = (await response.json()) as BankIdVerification;
    if (
      !data.status ||
      !["pending", "verified", "failed"].includes(data.status)
    )
      throw new Error("BankID provider returned an invalid status");
    return data;
  }
}

export function configuredBankIdAdapter(
  runtime: BankIdRuntime,
): BankIdAdapter | null {
  if (
    runtime.BANKID_PROVIDER !== "http" ||
    !runtime.BANKID_API_BASE_URL ||
    !runtime.BANKID_API_TOKEN
  )
    return null;
  return new HttpBankIdAdapter(
    runtime.BANKID_API_BASE_URL,
    runtime.BANKID_API_TOKEN,
    runtime.BANKID_START_PATH,
    runtime.BANKID_COLLECT_PATH,
  );
}

export class ManualId06Adapter implements Id06Adapter {
  async submitRegistration(
    _input: Id06RegistrationRequest,
  ): Promise<{ reference: string }> {
    void _input;
    throw new Error(
      "ID06 API adapter is not configured; use the admin queue for manual registration.",
    );
  }
}

export interface MailAdapter {
  send(message: {
    to: string;
    subject: string;
    html: string;
  }): Promise<{ providerReference?: string }>;
}
export class PlaceholderMailAdapter implements MailAdapter {
  async send() {
    return {};
  }
}

export class ResendMailAdapter implements MailAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: { to: string; subject: string; html: string }) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
      }),
    });
    if (!response.ok)
      throw new Error(`Mail provider returned ${response.status}`);
    const data = (await response.json()) as { id?: string };
    return { providerReference: data.id };
  }
}
