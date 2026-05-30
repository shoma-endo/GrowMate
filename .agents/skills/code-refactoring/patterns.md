# リファクタリング手法

ふるまいを保ったままコードを整理する代表的な手法。1つずつ小さく適用する。

## Step 1: Extract Method（メソッド抽出）

**Before（長い関数）**:

```typescript
async function processOrder(order: Order) {
  // Validation
  if (!order.items || order.items.length === 0) {
    throw new Error('Order must have items');
  }
  if (!order.customerId) {
    throw new Error('Order must have customer');
  }

  // Price calculation
  let total = 0;
  for (const item of order.items) {
    total += item.price * item.quantity;
  }
  const tax = total * 0.1;
  const shipping = total > 100 ? 0 : 10;
  const finalTotal = total + tax + shipping;

  // Inventory check
  for (const item of order.items) {
    const product = await db.product.findUnique({ where: { id: item.productId } });
    if (product.stock < item.quantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }
  }

  // Create order
  const newOrder = await db.order.create({
    data: {
      customerId: order.customerId,
      items: order.items,
      total: finalTotal,
      status: 'pending',
    },
  });

  return newOrder;
}
```

**After（メソッド抽出）**:

```typescript
async function processOrder(order: Order) {
  validateOrder(order);
  const total = calculateTotal(order);
  await checkInventory(order);
  return await createOrder(order, total);
}

function validateOrder(order: Order) {
  if (!order.items || order.items.length === 0) {
    throw new Error('Order must have items');
  }
  if (!order.customerId) {
    throw new Error('Order must have customer');
  }
}

function calculateTotal(order: Order): number {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.1;
  const shipping = subtotal > 100 ? 0 : 10;
  return subtotal + tax + shipping;
}

async function checkInventory(order: Order) {
  for (const item of order.items) {
    const product = await db.product.findUnique({ where: { id: item.productId } });
    if (product.stock < item.quantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }
  }
}

async function createOrder(order: Order, total: number) {
  return await db.order.create({
    data: {
      customerId: order.customerId,
      items: order.items,
      total,
      status: 'pending',
    },
  });
}
```

## Step 2: Remove Duplication（重複の除去）

**Before（重複）**:

```typescript
async function getActiveUsers() {
  return await db.user.findMany({
    where: { status: 'active', deletedAt: null },
    select: { id: true, name: true, email: true },
  });
}

async function getActivePremiumUsers() {
  return await db.user.findMany({
    where: { status: 'active', deletedAt: null, plan: 'premium' },
    select: { id: true, name: true, email: true },
  });
}
```

**After（共通ロジック抽出）**:

```typescript
type UserFilter = {
  plan?: string;
};

async function getActiveUsers(filter: UserFilter = {}) {
  return await db.user.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      ...filter,
    },
    select: { id: true, name: true, email: true },
  });
}

// Usage
const allActiveUsers = await getActiveUsers();
const premiumUsers = await getActiveUsers({ plan: 'premium' });
```

## Step 3: Replace Conditional with Polymorphism（条件分岐のポリモーフィズム化）

**Before（長い if-else）**:

```typescript
// tokenizeCard, chargeCreditCard 等は外部API呼び出しのため本例では省略
class PaymentProcessor {
  async process(payment: Payment) {
    if (payment.method === 'credit_card') {
      const cardToken = await this.tokenizeCard(payment.card);
      const charge = await this.chargeCreditCard(cardToken, payment.amount);
      return charge;
    } else if (payment.method === 'paypal') {
      const paypalOrder = await this.createPayPalOrder(payment.amount);
      const approval = await this.getPayPalApproval(paypalOrder);
      return approval;
    } else if (payment.method === 'bank_transfer') {
      const transfer = await this.initiateBankTransfer(payment.account, payment.amount);
      return transfer;
    }
  }
}
```

**After（ポリモーフィズム）**:

```typescript
// 各クラス内の tokenizeCard, chargeCreditCard 等は外部API呼び出しのため省略
interface PaymentMethod {
  process(payment: Payment): Promise<PaymentResult>;
}

class CreditCardPayment implements PaymentMethod {
  async process(payment: Payment): Promise<PaymentResult> {
    const cardToken = await this.tokenizeCard(payment.card);
    return await this.chargeCreditCard(cardToken, payment.amount);
  }
}

class PayPalPayment implements PaymentMethod {
  async process(payment: Payment): Promise<PaymentResult> {
    const order = await this.createPayPalOrder(payment.amount);
    return await this.getPayPalApproval(order);
  }
}

class BankTransferPayment implements PaymentMethod {
  async process(payment: Payment): Promise<PaymentResult> {
    return await this.initiateBankTransfer(payment.account, payment.amount);
  }
}

class PaymentProcessor {
  private methods: Map<string, PaymentMethod> = new Map([
    ['credit_card', new CreditCardPayment()],
    ['paypal', new PayPalPayment()],
    ['bank_transfer', new BankTransferPayment()],
  ]);

  async process(payment: Payment): Promise<PaymentResult> {
    const method = this.methods.get(payment.method);
    if (!method) {
      throw new Error(`Unknown payment method: ${payment.method}`);
    }
    return await method.process(payment);
  }
}
```

## Step 4: Introduce Parameter Object（パラメータオブジェクトの導入）

**Before（多すぎる引数）**:

```typescript
function createUser(
  name: string,
  email: string,
  password: string,
  age: number,
  country: string,
  city: string,
  postalCode: string,
  phoneNumber: string
) {
  // ...
}
```

**After（オブジェクトへ集約）**:

```typescript
interface UserProfile {
  name: string;
  email: string;
  password: string;
  age: number;
}

interface Address {
  country: string;
  city: string;
  postalCode: string;
}

interface CreateUserParams {
  profile: UserProfile;
  address: Address;
  phoneNumber: string;
}

function createUser(params: CreateUserParams) {
  const { profile, address, phoneNumber } = params;
  // ...
}

// Usage
createUser({
  profile: { name: 'John', email: 'john@example.com', password: 'xxx', age: 30 },
  address: { country: 'US', city: 'NYC', postalCode: '10001' },
  phoneNumber: '+1234567890',
});
```

## Step 5: Apply SOLID Principles（SOLID 原則の適用）

**Single Responsibility（単一責任）**:

```typescript
// ❌ Bad example: multiple responsibilities
class User {
  constructor(
    public name: string,
    public email: string
  ) {}

  save() {
    // Save to DB
  }

  sendEmail(subject: string, body: string) {
    // Send email
  }

  generateReport() {
    // Generate report
  }
}

// ✅ Good example: separated responsibilities
class User {
  constructor(
    public name: string,
    public email: string
  ) {}
}

class UserRepository {
  save(user: User) {
    // Save to DB
  }
}

class EmailService {
  send(to: string, subject: string, body: string) {
    // Send email
  }
}

class UserReportGenerator {
  generate(user: User) {
    // Generate report
  }
}
```

## リファクタリングチェックリスト

```markdown
- [ ] 関数は1つのことだけを行う（SRP）
- [ ] 関数名がその振る舞いを明確に表している
- [ ] 関数は20行以内（目安）
- [ ] 引数は3つ以内
- [ ] 重複コードがない（DRY）
- [ ] if のネストは2段以内
- [ ] マジックナンバーがない（定数として抽出）
- [ ] コメントなしで理解できる（self-documenting）
```

## ベストプラクティス

1. **Boy Scout Rule**: 触れたコードは来たときより綺麗にして去る
2. **リファクタのタイミング**: Red-Green-Refactor（TDD）
3. **段階的改善**: 完璧さより一貫性
4. **ふるまい保存**: リファクタリングは機能変更を伴わない
5. **小さなコミット**: 目的単位でコミットする
