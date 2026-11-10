import { OAuthResume } from "@/components/ConnectBank";

/** Plaid redirects here after OAuth banks (e.g. Chase). Set PLAID_REDIRECT_URI to https://<your-domain>/oauth */
export default function OAuthPage() {
  return <OAuthResume />;
}
