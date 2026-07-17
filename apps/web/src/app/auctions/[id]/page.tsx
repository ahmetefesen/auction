import { AuctionRoom } from "@/components/AuctionRoom";
import type { AuctionDto } from "@auction/shared";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

async function fetchAuction(id: string): Promise<AuctionDto | null> {
  try {
    const res = await fetch(`${API_URL}/auctions/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (data && typeof data === "object" && "id" in data) {
      return data as AuctionDto;
    }
    return null;
  } catch {
    return null;
  }
}

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auction = await fetchAuction(id);
  if (!auction) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-mist-300">
        Auction not found.
      </div>
    );
  }
  return <AuctionRoom initial={auction} apiUrl={API_URL} />;
}
