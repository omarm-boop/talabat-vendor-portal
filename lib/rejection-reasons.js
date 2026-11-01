// Rejection reasons shared by the browser (index.html) and the API (update-status.js, bulk-action.js).
// resubmit = the vendor can fix the problem and resubmit as a new request.
// Source: "On Ground Requests - Rejected Reason Script" (analysis in rejection-reasons.xlsx).
const REJECTION_REASONS = [
 {
  "code": "MISSING_IMAGE",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "لم يتم إرفاق صورة المنتج. يرجى إرفاق صورة واضحة.",
  "en": "No product image attached",
  "resubmit": true
 },
 {
  "code": "BAD_IMAGE",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "جودة الصورة منخفضة. يرجى إرسال صورة عالية الجودة بخلفية بيضاء.",
  "en": "Low-quality image; need high quality, white background",
  "resubmit": true
 },
 {
  "code": "MISSING_NAME",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "الاسم الكامل للمنتج غير مكتمل. يرجى كتابته كاملًا.",
  "en": "Full product name missing",
  "resubmit": true
 },
 {
  "code": "MISSING_PRODUCT_INFO",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "بيانات المنتج غير مكتملة. يرجى إرسال البيانات الكاملة.",
  "en": "Complete product information needed",
  "resubmit": true
 },
 {
  "code": "MISSING_BARCODE",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "الباركود الدولي غير متوفر. يرجى إرفاقه.",
  "en": "International barcode missing",
  "resubmit": true
 },
 {
  "code": "MISSING_SKU",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "الكود الداخلي للصنف غير متوفر. يرجى إرفاقه.",
  "en": "Internal code (SKU) missing",
  "resubmit": true
 },
 {
  "code": "MISSING_PRICE",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "سعر الصنف غير متوفر. يرجى إضافته.",
  "en": "Price missing",
  "resubmit": true
 },
 {
  "code": "MISSING_BRAND",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "اسم العلامة التجارية غير متوفر. يرجى إضافته.",
  "en": "Brand name missing",
  "resubmit": true
 },
 {
  "code": "MISSING_WEIGHT_SIZE",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "بيانات الوزن أو الحجم ناقصة. يرجى استكمالها.",
  "en": "Weight / size missing",
  "resubmit": true
 },
 {
  "code": "MISSING_CHAIN_BRANCH",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "اسم السلسلة أو الفرع غير مذكور. يرجى ذكرهما.",
  "en": "Chain and/or branch name missing",
  "resubmit": true
 },
 {
  "code": "CHAIN_NOT_FOUND",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "لم نجد اسم السلسلة. يرجى إرسال كود الفرع أو كود السلسلة.",
  "en": "Chain not found; send branch or chain code",
  "resubmit": true
 },
 {
  "code": "UNCLEAR_REQUEST",
  "group": "Missing information",
  "groupAr": "معلومات ناقصة",
  "ar": "الطلب غير واضح. يرجى توضيح المطلوب بدقة.",
  "en": "Request unclear",
  "resubmit": true
 },
 {
  "code": "IMAGE_NAME_MISMATCH",
  "group": "Incorrect data",
  "groupAr": "بيانات غير صحيحة",
  "ar": "الصورة لا تطابق اسم المنتج. يرجى تصحيح أحدهما.",
  "en": "Image and name do not match",
  "resubmit": true
 },
 {
  "code": "CODE_NOT_FOUND",
  "group": "Incorrect data",
  "groupAr": "بيانات غير صحيحة",
  "ar": "لم نجد الصنف بهذا الباركود أو الكود الداخلي. يرجى التحقق منهما.",
  "en": "Item not found by barcode / internal code",
  "resubmit": true
 },
 {
  "code": "CODE_LINKED_OTHER",
  "group": "Incorrect data",
  "groupAr": "بيانات غير صحيحة",
  "ar": "الكود مرتبط بمنتج آخر. يرجى مراجعة الأكواد وإرسال الصحيح منها.",
  "en": "Code is linked to another product/code (add {code} in note)",
  "resubmit": true
 },
 {
  "code": "MULTI_ONE_CODE",
  "group": "Incorrect data",
  "groupAr": "بيانات غير صحيحة",
  "ar": "لا يمكن ربط أكثر من منتج بكود داخلي واحد. يرجى إرسال كود لكل نوع أو لون.",
  "en": "Cannot link several products to one internal code",
  "resubmit": true
 },
 {
  "code": "BOTH_CODES_EXIST",
  "group": "Incorrect data",
  "groupAr": "بيانات غير صحيحة",
  "ar": "الكودان موجودان في الكتالوج. يرجى توضيح الصحيح والخاطئ.",
  "en": "Both codes exist; clarify right vs wrong",
  "resubmit": true
 },
 {
  "code": "WRONG_FORM",
  "group": "Incorrect data",
  "groupAr": "بيانات غير صحيحة",
  "ar": "تم استخدام نموذج غير مناسب. يرجى إرسال الطلب بالنموذج الصحيح.",
  "en": "Wrong request type / form used",
  "resubmit": true
 },
 {
  "code": "EXPLAIN_DELETE",
  "group": "Incorrect data",
  "groupAr": "بيانات غير صحيحة",
  "ar": "يرجى توضيح سبب حذف المنتج.",
  "en": "Reason for deleting the product needed",
  "resubmit": true
 },
 {
  "code": "ALREADY_DONE",
  "group": "Duplicate / exists",
  "groupAr": "مكرر أو موجود",
  "ar": "تم تنفيذ هذا التحديث مسبقًا.",
  "en": "Update already done",
  "resubmit": false
 },
 {
  "code": "ALREADY_EXISTS",
  "group": "Duplicate / exists",
  "groupAr": "مكرر أو موجود",
  "ar": "الصنف موجود مسبقًا في الكتالوج.",
  "en": "Item already in catalog",
  "resubmit": false
 },
 {
  "code": "EXISTS_OTHER_NAME",
  "group": "Duplicate / exists",
  "groupAr": "مكرر أو موجود",
  "ar": "الصنف موجود في نظامنا باسم منتج آخر.",
  "en": "Item exists in main system under another product name",
  "resubmit": false
 },
 {
  "code": "DUPLICATE_IN_CATALOG",
  "group": "Duplicate / exists",
  "groupAr": "مكرر أو موجود",
  "ar": "الصنف مكرر في الكتالوج.",
  "en": "Item duplicated in catalog",
  "resubmit": false
 },
 {
  "code": "NOT_ON_BRANCH_MENU",
  "group": "Not available / not allowed",
  "groupAr": "غير متاح أو غير مسموح",
  "ar": "المنتج غير موجود في قائمة الفرع.",
  "en": "Product not on branch menu / list",
  "resubmit": false
 },
 {
  "code": "RX_MEDICINE",
  "group": "Not available / not allowed",
  "groupAr": "غير متاح أو غير مسموح",
  "ar": "دواء يُصرف بروشتة ولا يمكن إضافته على طلبات.",
  "en": "Prescription medicine cannot be listed",
  "resubmit": false
 },
 {
  "code": "MEDICINE_NOT_ALLOWED",
  "group": "Not available / not allowed",
  "groupAr": "غير متاح أو غير مسموح",
  "ar": "هذا الدواء غير مصرّح به على طلبات.",
  "en": "Medicine not authorised on Talabat",
  "resubmit": false
 },
 {
  "code": "CANNOT_DELETE",
  "group": "Not available / not allowed",
  "groupAr": "غير متاح أو غير مسموح",
  "ar": "لا يمكن حذف المنتج. يمكنكم إيقافه عبر ملف SFTP اليومي.",
  "en": "Products cannot be deleted; close via daily SFTP",
  "resubmit": false
 },
 {
  "code": "SFTP_UPDATE",
  "group": "Not available / not allowed",
  "groupAr": "غير متاح أو غير مسموح",
  "ar": "تحديث السعر والتوفر يتم عبر ملف SFTP اليومي.",
  "en": "Price/availability handled via daily SFTP",
  "resubmit": false
 },
 {
  "code": "CONTACT_AM",
  "group": "Account manager",
  "groupAr": "مدير الحساب",
  "ar": "يرجى مراجعة الطلب مع مدير حسابكم.",
  "en": "Review request with account manager",
  "resubmit": false
 },
 {
  "code": "BULK_ADD",
  "group": "Account manager",
  "groupAr": "مدير الحساب",
  "ar": "لإضافة عدد كبير من المنتجات، يرجى التواصل مع مدير حسابكم.",
  "en": "Large additions go through account manager",
  "resubmit": false
 },
 {
  "code": "AM_NOT_APPROVED",
  "group": "Account manager",
  "groupAr": "مدير الحساب",
  "ar": "لم يوافق مدير الحساب على الطلب.",
  "en": "Account manager did not approve",
  "resubmit": false
 },
 {
  "code": "PARTIAL_DONE",
  "group": "Partial / forwarded (not a pure rejection)",
  "groupAr": "تنفيذ جزئي أو تحويل",
  "ar": "تم تنفيذ جزء من الطلب فقط. التفاصيل في الملاحظة.",
  "en": "Partly done; remaining part explained in note",
  "resubmit": true
 },
 {
  "code": "FORWARDED_SPECIALIST",
  "group": "Partial / forwarded (not a pure rejection)",
  "groupAr": "تنفيذ جزئي أو تحويل",
  "ar": "تعديل الاسم أو الصورة يتم عبر فريق مختص، وتم تحويل الطلب إليهم.",
  "en": "Name/image changes handled by specialist team; forwarded",
  "resubmit": false
 },
 {
  "code": "FORWARDED_ADD",
  "group": "Partial / forwarded (not a pure rejection)",
  "groupAr": "تنفيذ جزئي أو تحويل",
  "ar": "الصنف غير متوفر في نظامنا وتم تحويله للفريق المختص لإضافته.",
  "en": "Item not in system; forwarded to be added",
  "resubmit": false
 }
];

const NO_RESUBMIT = 'NO_RESUBMIT'; // marker stored with the codes when the vendor may not resubmit

function reasonByCode(code) {
  return REJECTION_REASONS.find(r => r.code === code);
}

// Keep only known codes, in the order given, without duplicates.
function cleanCodes(codes) {
  const seen = new Set();
  return (Array.isArray(codes) ? codes : []).filter(c => {
    if (!reasonByCode(c) || seen.has(c)) return false;
    seen.add(c); return true;
  });
}

// Human-readable text stored in the "Rejection Reason" column (Arabic reasons + optional note).
function composeReason(codes, note) {
  const parts = codes.map(c => reasonByCode(c).ar);
  const n = String(note || '').trim();
  if (n) parts.push(n);
  return parts.join(' • ');
}

// Vendor may resubmit when at least one reason is fixable, unless the team overrides it.
function canResubmit(codes, allowOverride) {
  if (typeof allowOverride === 'boolean') return allowOverride;
  return codes.length === 0 || codes.some(c => reasonByCode(c).resubmit);
}

const _api = { REJECTION_REASONS, NO_RESUBMIT, reasonByCode, cleanCodes, composeReason, canResubmit };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
else Object.assign(window, _api);
