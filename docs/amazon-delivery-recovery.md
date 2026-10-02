# Amazon delivery recovery

Price checks use each store's saved Amazon delivery postcode; listing postcode and suburb remain separate. A product observation is accepted only after the final page verifies the exact postcode and ASIN. Buy Box and requested regular/deal price mode must also be verified. Reuse stores browser delivery state only within a store and run; prices and stock are fresh for every product.

A temporary error, challenge, invalid address response, popup timeout, or unverifiable final page is a technical failure. The product remains unfinished. A persistent store cooldown waits 1, 2, 5, then 15 minutes between probes; one worker may probe at a time. Verified product-specific unavailability resumes ordinary hold rules. Cancellation preserves completed checkpoints and stops further scraping.

The 2026-10-02 incident exposed repeated Amazon `Server Busy` pages on the former worker PC. The bundled repaired probe there received HTTP 200 error HTML with no product markers for all three stores, before postcode setup. The same probe on this PC verified postcode `2217` for all three sampled products. The precise difference between the PCs is unproven; local recovery and the cooldown were tested independently.

Inspect worker status, job wait reason, and redacted diagnostics when technical failures recur. Never interpret a successful postcode submission alone as final-page verification. The read-only probe can distinguish a valid product page from Amazon error content without writing product, price, stock, or eBay state.