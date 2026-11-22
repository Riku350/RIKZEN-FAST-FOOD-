import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, ImagePlus, Upload, X } from 'lucide-react';
import { MENU_CATEGORIES, STUDIO_FOOD_GALLERY } from '../data/menuCatalog';
import {
  formatRupees,
  ownerSaveMenuItem,
  ownerSaveOffer,
  uploadDishImageToServer,
} from '../lib/orderService';
import {
  getDiscountPercent,
  MenuCategoryId,
  MenuItem,
  OfferRecord,
} from '../types/restaurant';
import { FoodImage } from './FoodImage';

interface MenuItemModalProps {
  open: boolean;
  editingItem: MenuItem | null;
  focusOffer?: boolean;
  onClose: () => void;
}

export const MenuItemModal: React.FC<MenuItemModalProps> = ({
  open,
  editingItem,
  focusOffer = false,
  onClose,
}) => {
  const offerInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<MenuCategoryId>('rolls');
  const [price, setPrice] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState(STUDIO_FOOD_GALLERY[0].url);
  const [available, setAvailable] = useState(true);
  const [isVeg, setIsVeg] = useState(false);
  const [featured, setFeatured] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedSuccess(false);
    if (editingItem) {
      setName(editingItem.name);
      setCategory(editingItem.category);
      setPrice(String(editingItem.price));
      setOfferPrice(editingItem.offer_price > 0 ? String(editingItem.offer_price) : '');
      setDescription(editingItem.description);
      setImage(editingItem.image);
      setAvailable(editingItem.available);
      setIsVeg(editingItem.is_veg);
      setFeatured(editingItem.featured);
    } else {
      setName('');
      setCategory('rolls');
      setPrice('');
      setOfferPrice('');
      setDescription('');
      setImage(STUDIO_FOOD_GALLERY[0].url);
      setAvailable(true);
      setIsVeg(false);
      setFeatured(false);
    }
    if (focusOffer) {
      window.setTimeout(() => {
        offerInputRef.current?.focus();
        offerInputRef.current?.select();
      }, 120);
    }
  }, [open, editingItem, focusOffer]);

  if (!open) return null;

  const numPrice = Number(price) || 0;
  const numOffer = Number(offerPrice) || 0;
  const discountPct = getDiscountPercent(numPrice, numOffer);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploadedUrl = await uploadDishImageToServer(file);
      setImage(uploadedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) {
      setError('Please enter an item name.');
      return;
    }
    if (!numPrice || numPrice < 1 || numPrice > 20000) {
      setError('Please enter a valid regular price (₹1 – ₹20,000).');
      return;
    }
    if (offerPrice.trim() !== '' && (numOffer < 1 || numOffer >= numPrice)) {
      setError('Offer price must be lower than the regular price (or leave blank).');
      return;
    }

    setSaving(true);
    try {
      await ownerSaveMenuItem({
        id: editingItem?.id,
        name,
        category,
        description: description.trim() || `Freshly prepared ${name.trim()} at RikZen Fast Food.`,
        price: numPrice,
        offer_price: offerPrice.trim() === '' ? 0 : numOffer,
        image,
        available,
        is_veg: isVeg,
        featured,
        existingCreatedAt: editingItem?.created_at,
      });
      setSavedSuccess(true);
      window.setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save menu item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 14 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-lg bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-2xl my-auto"
        >
          {savedSuccess ? (
            <div className="p-10 text-center space-y-3">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto"
              >
                <CheckCircle2 className="w-9 h-9" />
              </motion.div>
              <h3 className="text-2xl font-extrabold text-neutral-900">
                {editingItem ? 'Item Updated!' : 'Item Added!'}
              </h3>
              <p className="text-sm text-neutral-500">Customer table menus updated live.</p>
            </div>
          ) : (
            <form onSubmit={handleSave}>
              <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
                <h3 id="item-modal-title" className="text-xl font-extrabold text-neutral-900">
                  {editingItem ? 'Edit Menu Item' : 'Add New Item'}
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close modal"
                  className="w-10 h-10 rounded-xl text-neutral-500 hover:bg-neutral-100 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[72vh] overflow-y-auto">
                {/* Food Image Preview + Quick Picker + Upload */}
                <div className="space-y-2.5">
                  <label className="block text-xs font-bold text-neutral-700">Food Image</label>
                  <div className="flex items-center gap-4">
                    <FoodImage
                      src={image}
                      alt={name || 'Food preview'}
                      className="w-24 h-20 rounded-2xl border border-neutral-200 shrink-0"
                    />
                    <div className="flex-1 space-y-2">
                      <label className="inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-xs font-semibold text-neutral-800 cursor-pointer transition-colors">
                        <Upload className="w-4 h-4" />
                        {uploading ? 'Uploading photo...' : 'Upload Photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handleFileUpload}
                          className="sr-only"
                        />
                      </label>
                      <p className="text-[11px] text-neutral-500">
                        Or tap a studio food photo below:
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                    {STUDIO_FOOD_GALLERY.map((photo) => (
                      <button
                        key={photo.url}
                        type="button"
                        onClick={() => setImage(photo.url)}
                        title={photo.label}
                        className={`w-14 h-11 rounded-xl overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                          image === photo.url
                            ? 'border-[#E5391B] scale-105'
                            : 'border-transparent opacity-75 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={photo.url}
                          alt={photo.label}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Item Name & Category */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label htmlFor="item-name" className="block text-xs font-bold text-neutral-700 mb-1">
                      Item Name *
                    </label>
                    <input
                      id="item-name"
                      type="text"
                      required
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Chicken Roll"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-[#E5391B]"
                    />
                  </div>
                  <div>
                    <label htmlFor="item-cat" className="block text-xs font-bold text-neutral-700 mb-1">
                      Category *
                    </label>
                    <select
                      id="item-cat"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as MenuCategoryId)}
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-neutral-200 text-sm bg-white focus:outline-none focus:border-[#E5391B]"
                    >
                      {MENU_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Regular Price & Offer Price with Automatic % Calculation */}
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label htmlFor="item-price" className="block text-xs font-bold text-neutral-700 mb-1">
                      Regular Price (₹) *
                    </label>
                    <input
                      id="item-price"
                      type="number"
                      min={1}
                      max={20000}
                      required
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="100"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-neutral-200 font-mono text-sm focus:outline-none focus:border-[#E5391B]"
                    />
                  </div>
                  <div>
                    <label htmlFor="item-offer" className="block text-xs font-bold text-neutral-700 mb-1">
                      Offer Price (₹ optional)
                    </label>
                    <input
                      ref={offerInputRef}
                      id="item-offer"
                      type="number"
                      min={1}
                      max={20000}
                      value={offerPrice}
                      onChange={(e) => setOfferPrice(e.target.value)}
                      placeholder="80"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-neutral-200 font-mono text-sm focus:outline-none focus:border-[#E5391B]"
                    />
                  </div>
                </div>

                {/* Automatic Discount Preview */}
                {discountPct > 0 && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-emerald-800 font-medium">Customer sees:</span>
                    <span className="font-mono font-bold text-emerald-900 tabular-nums">
                      <span className="line-through text-neutral-400 mr-2">
                        {formatRupees(numPrice)}
                      </span>
                      {formatRupees(numOffer)} ·{' '}
                      <span className="text-[#E5391B]">{discountPct}% OFF</span>
                    </span>
                  </div>
                )}

                {/* Description */}
                <div>
                  <label htmlFor="item-desc" className="block text-xs font-bold text-neutral-700 mb-1">
                    Short Description
                  </label>
                  <textarea
                    id="item-desc"
                    rows={2}
                    maxLength={220}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Crispy, hot, freshly prepared with house sauces..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-[#E5391B]"
                  />
                </div>

                {/* Simple Toggles */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setAvailable((a) => !a)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                      available
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                    }`}
                  >
                    {available ? 'Available (In Stock)' : 'Unavailable (Sold Out)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsVeg((v) => !v)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                      isVeg
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}
                  >
                    {isVeg ? 'Pure Veg Item' : 'Non-Veg Item'}
                  </button>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                    {error}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-200 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 min-h-[48px] rounded-xl border border-neutral-200 bg-white text-sm font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploading}
                  className="flex-1 min-h-[48px] rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Item'}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

interface OfferModalProps {
  open: boolean;
  editingOffer: OfferRecord | null;
  onClose: () => void;
}

export const OfferModal: React.FC<OfferModalProps> = ({ open, editingOffer, onClose }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [image, setImage] = useState(STUDIO_FOOD_GALLERY[1].url);
  const [active, setActive] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedSuccess(false);
    if (editingOffer) {
      setTitle(editingOffer.title);
      setDescription(editingOffer.description);
      setRegularPrice(String(editingOffer.regular_price));
      setOfferPrice(String(editingOffer.offer_price));
      setImage(editingOffer.image);
      setActive(editingOffer.active);
    } else {
      setTitle('');
      setDescription('');
      setRegularPrice('');
      setOfferPrice('');
      setImage(STUDIO_FOOD_GALLERY[1].url);
      setActive(true);
    }
  }, [open, editingOffer]);

  if (!open) return null;

  const numReg = Number(regularPrice) || 0;
  const numOffer = Number(offerPrice) || 0;
  const discountPct = getDiscountPercent(numReg, numOffer);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadDishImageToServer(file);
      setImage(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 2) {
      setError('Please enter an offer title.');
      return;
    }
    if (numReg < 2 || numOffer < 1 || numOffer >= numReg) {
      setError('Offer price must be strictly less than regular price.');
      return;
    }

    setSaving(true);
    try {
      await ownerSaveOffer({
        id: editingOffer?.id,
        title,
        description: description.trim() || `Special RikZen combo deal: ${title.trim()}.`,
        image,
        regular_price: numReg,
        offer_price: numOffer,
        active,
        existingCreatedAt: editingOffer?.created_at,
      });
      setSavedSuccess(true);
      window.setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save offer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offer-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 14 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-md bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-2xl my-auto"
        >
          {savedSuccess ? (
            <div className="p-10 text-center space-y-3">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto"
              >
                <CheckCircle2 className="w-9 h-9" />
              </motion.div>
              <h3 className="text-2xl font-extrabold text-neutral-900">Offer Saved!</h3>
              <p className="text-sm text-neutral-500">Live on customer table menus immediately.</p>
            </div>
          ) : (
            <form onSubmit={handleSave}>
              <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
                <h3 id="offer-modal-title" className="text-xl font-extrabold text-neutral-900">
                  {editingOffer ? 'Edit Offer' : 'Create Offer'}
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close offer modal"
                  className="w-10 h-10 rounded-xl text-neutral-500 hover:bg-neutral-100 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="flex items-center gap-3">
                  <FoodImage
                    src={image}
                    alt={title || 'Offer preview'}
                    className="w-20 h-16 rounded-xl border border-neutral-200 shrink-0"
                  />
                  <label className="inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-xs font-semibold text-neutral-800 cursor-pointer">
                    <ImagePlus className="w-4 h-4" />
                    {uploading ? 'Uploading...' : 'Upload Photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileUpload}
                      className="sr-only"
                    />
                  </label>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                  {STUDIO_FOOD_GALLERY.map((photo) => (
                    <button
                      key={photo.url}
                      type="button"
                      onClick={() => setImage(photo.url)}
                      className={`w-12 h-10 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer ${
                        image === photo.url ? 'border-[#E5391B]' : 'border-transparent opacity-70'
                      }`}
                    >
                      <img src={photo.url} alt={photo.label} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>

                <div>
                  <label htmlFor="offer-title" className="block text-xs font-bold text-neutral-700 mb-1">
                    Offer Name *
                  </label>
                  <input
                    id="offer-title"
                    type="text"
                    required
                    maxLength={80}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Burger Combo"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-[#E5391B]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label htmlFor="offer-reg" className="block text-xs font-bold text-neutral-700 mb-1">
                      Regular Price (₹) *
                    </label>
                    <input
                      id="offer-reg"
                      type="number"
                      min={2}
                      max={20000}
                      required
                      value={regularPrice}
                      onChange={(e) => setRegularPrice(e.target.value)}
                      placeholder="199"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-neutral-200 font-mono text-sm focus:outline-none focus:border-[#E5391B]"
                    />
                  </div>
                  <div>
                    <label htmlFor="offer-price" className="block text-xs font-bold text-neutral-700 mb-1">
                      Offer Price (₹) *
                    </label>
                    <input
                      id="offer-price"
                      type="number"
                      min={1}
                      max={20000}
                      required
                      value={offerPrice}
                      onChange={(e) => setOfferPrice(e.target.value)}
                      placeholder="149"
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-neutral-200 font-mono text-sm focus:outline-none focus:border-[#E5391B]"
                    />
                  </div>
                </div>

                {discountPct > 0 && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-emerald-800 font-medium">Auto Discount</span>
                    <span className="font-mono font-bold text-[#E5391B] tabular-nums">
                      {discountPct}% OFF (Save {formatRupees(numReg - numOffer)})
                    </span>
                  </div>
                )}

                <div>
                  <label htmlFor="offer-desc" className="block text-xs font-bold text-neutral-700 mb-1">
                    Combo Details
                  </label>
                  <textarea
                    id="offer-desc"
                    rows={2}
                    maxLength={200}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Crispy Burger + Golden Fries + Chilled Drink"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-[#E5391B]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setActive((a) => !a)}
                  className={`w-full min-h-[44px] px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                    active
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                  }`}
                >
                  {active ? 'Offer Enabled (Visible to Customers)' : 'Offer Disabled (Hidden)'}
                </button>

                {error && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                    {error}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-200 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 min-h-[48px] rounded-xl border border-neutral-200 bg-white text-sm font-semibold text-neutral-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploading}
                  className="flex-1 min-h-[48px] rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Offer'}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
