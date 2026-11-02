import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getMySignature } from "@/lib/dal/signature";
import { getYearContext } from "@/lib/dal/years";
import { isPreviewDeployment, signatureAssetBase } from "@/lib/http/base-url";
import { SignatureBuilder } from "@/components/signature/signature-builder";

export default async function MySignaturePage() {
  const session = await auth();
  const user = session!.user;
  const [{ currentYear: YEAR, years }, signature, assetBase] = await Promise.all([
    getYearContext(),
    getMySignature(Number(user.id)),
    signatureAssetBase(),
  ]);
  if (!signature) redirect("/login");

  return (
    <>
      <Topbar section="Me" title="Email signature" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1100px] px-6 py-6">
        <SignatureBuilder
          initial={signature.fields}
          defaults={signature.defaults}
          saved={signature.saved}
          assetBase={assetBase}
          testEnvironment={isPreviewDeployment() || /\/\/(localhost|127\.0\.0\.1)/.test(assetBase)}
        />
      </main>
    </>
  );
}
