import Link from "next/link";
import type { AuctionDto } from "@auction/shared";
import { FlashBanner } from "@/components/FlashBanner";
import { formatTry } from "@/lib/format";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

async function fetchAuctions(): Promise<AuctionDto[]> {
  try {
    const res = await fetch(`${API_URL}/auctions?status=LIVE&pageSize=50`, {
      next: { revalidate: 5 },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (data && typeof data === "object" && "items" in data && Array.isArray(data.items)) {
      return data.items as AuctionDto[];
    }
    return [];
  } catch {
    return [];
  }
}

export default async function AuctionsPage() {
  const items = await fetchAuctions();

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <FlashBanner />
      <h1 className="font-display text-4xl text-mist-50">Live auctions</h1>
      <p className="mt-2 text-mist-300">Active lots with real-time bidding.</p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {items.length === 0 ? (
          <p className="text-mist-300">No live auctions yet. Start the API and seed data.</p>
        ) : (
          items.map((auction) => (
            <Link
              key={auction.id}
              href={`/auctions/${auction.id}`}
              className="group block border-b border-white/10 pb-6 transition hover:border-brass-500/50"
            >
              <div className="aspect-[16/9] overflow-hidden bg-ink-800">
                {auction.images[0] ? (
                  <img
                    src={`${API_URL}${auction.images[0].url}`}
                    alt=""
                    className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-mist-300/40">No image</div>
                )}
              </div>
              <h2 className="mt-4 font-display text-2xl text-mist-50">{auction.title}</h2>
              <p className="mt-1 text-brass-400">
                {auction.currentBid > 0 ? formatTry(auction.currentBid) : formatTry(auction.startingPrice)}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
