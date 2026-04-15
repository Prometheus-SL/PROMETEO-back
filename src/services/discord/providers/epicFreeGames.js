const EPIC_ENDPOINT = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=es-ES&country=ES&allowCountries=ES';
const STORE_BASE = 'https://store.epicgames.com/es-ES/p/';

function pickImage(keyImages) {
    if (!Array.isArray(keyImages)) return null;
    const preferred = ['OfferImageWide', 'DieselStoreFrontWide', 'VaultClosed', 'Thumbnail'];
    for (const type of preferred) {
        const hit = keyImages.find((image) => image?.type === type && image?.url);
        if (hit) return hit.url;
    }
    return keyImages[0]?.url ?? null;
}

function pickActivePromotion(element) {
    const groups = element?.promotions?.promotionalOffers ?? [];
    for (const group of groups) {
        for (const offer of group?.promotionalOffers ?? []) {
            const percentage = offer?.discountSetting?.discountPercentage;
            // Epic returns 0 when the discount makes the game effectively free.
            if (percentage === 0) {
                return offer;
            }
        }
    }
    return null;
}

function pickSlug(element) {
    const mapping = element?.catalogNs?.mappings?.[0]?.pageSlug
        || element?.offerMappings?.[0]?.pageSlug
        || element?.productSlug
        || element?.urlSlug;
    return mapping ? String(mapping).replace(/\/home$/, '') : null;
}

function normalize(element) {
    const promo = pickActivePromotion(element);
    if (!promo) return null;

    const slug = pickSlug(element);
    if (!slug) return null;

    const priceOriginal = element?.price?.totalPrice?.fmtPrice?.originalPrice ?? '';
    const endDate = promo?.endDate;
    if (!endDate) return null;

    return {
        id: String(element.id),
        title: String(element.title ?? 'Juego sin título'),
        description: typeof element.description === 'string' ? element.description : '',
        priceOriginal,
        freeUntil: new Date(endDate),
        imageUrl: pickImage(element?.keyImages),
        storeUrl: `${STORE_BASE}${slug}`,
    };
}

function createEpicFreeGamesProvider({ endpoint = EPIC_ENDPOINT, fetchFn = null } = {}) {
    return {
        async fetchCurrentFreeGames() {
            const client = fetchFn || global.fetch;
            if (typeof client !== 'function') {
                throw new Error('fetch is not available in this Node runtime');
            }

            const response = await client(endpoint, {
                headers: { 'User-Agent': 'Prometeo/1.0 (+epic-free-games)' },
            });

            if (!response.ok) {
                throw new Error(`Epic API returned ${response.status}`);
            }

            let payload;
            try {
                payload = await response.json();
            } catch (err) {
                throw new Error(`Epic API returned malformed JSON: ${err.message}`);
            }

            const elements = payload?.data?.Catalog?.searchStore?.elements;
            if (!Array.isArray(elements)) {
                throw new Error('Epic API returned unexpected shape (missing elements[])');
            }

            return elements.map(normalize).filter(Boolean);
        },
    };
}

module.exports = { createEpicFreeGamesProvider };
