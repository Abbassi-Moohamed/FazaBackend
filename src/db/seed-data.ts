/**
 * Realistic Faza development data.
 *
 * Every coffee owns a DIFFERENT set of categories and items on purpose:
 * this is what proves the multi-tenant isolation actually works when you
 * query the public API.
 */
export interface SeedItem {
  name: string;
  description: string;
  price: number;
  image: string;
}

export interface SeedCategory {
  name: string;
  items: SeedItem[];
}

export interface SeedCoffee {
  name: string;
  slug: string;
  logo: string;
  categories: SeedCategory[];
}

const image = (seed: string): string => `https://picsum.photos/seed/${seed}/400/300`;

export const menuSeed: SeedCoffee[] = [
  {
    name: "Café El Manzah",
    slug: "cafe-el-manzah",
    logo: "https://picsum.photos/seed/manzah-logo/400/400",
    categories: [
      {
        name: "Cafés",
        items: [
          { name: "Espresso", description: "Café espresso traditionnel", price: 2.5, image: image("manzah-espresso") },
          { name: "Cappuccino", description: "Espresso, lait vapeur et mousse soyeuse", price: 4.0, image: image("manzah-cappuccino") },
          { name: "Café Crème", description: "Espresso allongé avec un nuage de crème", price: 3.0, image: image("manzah-creme") },
        ],
      },
      {
        name: "Boissons chaudes",
        items: [
          { name: "Thé à la menthe", description: "Thé vert infusé à la menthe fraîche", price: 3.0, image: image("manzah-the") },
          { name: "Chocolat chaud", description: "Chocolat fondant, crème fouettée maison", price: 3.5, image: image("manzah-chocolat") },
        ],
      },
      {
        name: "Jus",
        items: [
          { name: "Jus d'orange pressé", description: "Orange pressée à la minute", price: 4.0, image: image("manzah-orange") },
          { name: "Citronnade maison", description: "Citron frais, menthe et sucre de canne", price: 4.5, image: image("manzah-citron") },
        ],
      },
      {
        name: "Desserts",
        items: [
          { name: "Cheesecake", description: "Cheesecake crémeux sur base biscuitée", price: 6.5, image: image("manzah-cheesecake") },
          { name: "Tiramisu", description: "Mascarpone, café et cacao amer", price: 6.0, image: image("manzah-tiramisu") },
        ],
      },
      {
        name: "Petit-déjeuner",
        items: [
          { name: "Croissant au beurre", description: "Feuilleté pur beurre cuit sur place", price: 2.0, image: image("manzah-croissant") },
          { name: "Omelette tunisienne", description: "Harissa, poivrons et pommes de terre", price: 5.5, image: image("manzah-omelette") },
        ],
      },
    ],
  },
  {
    name: "Brew & Beans",
    slug: "brew-and-beans",
    logo: "https://picsum.photos/seed/brew-logo/400/400",
    categories: [
      {
        // Same category name as Café El Manzah on purpose: isolation must
        // be enforced by the coffeeId relationship, not by category names.
        name: "Cafés",
        items: [
          { name: "Espresso", description: "Espresso serré, notes de cacao", price: 2.2, image: image("brew-espresso") },
          { name: "Americano", description: "Espresso allongé à l'eau chaude", price: 2.8, image: image("brew-americano") },
        ],
      },
      {
        name: "Jus",
        items: [
          { name: "Orange Juice", description: "Freshly squeezed Valencia oranges", price: 4.0, image: image("brew-juice") },
        ],
      },
      {
        name: "Bakery",
        items: [
          { name: "Butter Croissant", description: "Laminated French butter croissant", price: 2.5, image: image("brew-bakery") },
          { name: "Banana Bread", description: "Roasted banana bread, walnuts", price: 3.5, image: image("brew-banana") },
        ],
      },
    ],
  },
  {
    name: "Coffee Leaf",
    slug: "coffee-leaf",
    logo: "https://picsum.photos/seed/leaf-logo/400/400",
    categories: [
      {
        name: "Hot Coffees",
        items: [
          { name: "Flat White", description: "Double ristretto, silky microfoam", price: 4.2, image: image("leaf-flatwhite") },
          { name: "Mocha", description: "Espresso, chocolate and steamed milk", price: 4.5, image: image("leaf-mocha") },
        ],
      },
      {
        name: "Iced Drinks",
        items: [
          { name: "Iced Latte", description: "Espresso over cold milk and ice", price: 4.0, image: image("leaf-icedlatte") },
          { name: "Cold Brew", description: "12-hour steep, smooth and low acid", price: 4.5, image: image("leaf-coldbrew") },
        ],
      },
      {
        name: "Tea Selection",
        items: [
          { name: "Green Tea", description: "Sencha, vegetal and fresh", price: 2.8, image: image("leaf-green") },
          { name: "Earl Grey", description: "Bergamot black tea", price: 2.8, image: image("leaf-earl") },
        ],
      },
      {
        name: "Brunch",
        items: [
          { name: "Avocado Toast", description: "Sourdough, smashed avocado, chili flakes", price: 8.0, image: image("leaf-avocado") },
          { name: "French Toast", description: "Brioche, maple syrup and berries", price: 6.5, image: image("leaf-frenchtoast") },
        ],
      },
    ],
  },
];