-- Add NayaPay and SadaPay as payment methods (ZP Battle feature set).
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'NAYAPAY';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SADAPAY';
